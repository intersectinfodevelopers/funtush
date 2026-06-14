import { Router, Request, Response, raw } from "express";
import {
  verifyStripeSignature,
  verifyKhaltiPayment,
  verifyEsewaSignature,
  verifyConnectIPSSignature,
} from "../lib/verifySignature";
import { processConfirmedPayment } from "../services/payment.service";

const router = Router();

// Stripe requires raw body for signature verification — apply raw() before JSON parser
router.post(
  "/:agencyId/stripe",
  raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const agencyId = req.params.agencyId as string;
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      res.status(500).json({ error: "Stripe webhook secret not configured" });
      return;
    }

    const isValid = verifyStripeSignature(req.body as Buffer, signature, secret);
    if (!isValid) {
      res.status(400).json({ error: "Invalid Stripe signature" });
      return;
    }

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse((req.body as Buffer).toString());
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    if (event.type !== "payment_intent.succeeded") {
      res.status(200).json({ received: true });
      return;
    }

    const paymentIntent = event.data.object as {
      metadata: { bookingId: string; agencyId: string };
      amount_received: number;
    };

    const { bookingId, agencyId: metaAgencyId } = paymentIntent.metadata;

    if (!bookingId || metaAgencyId !== agencyId) {
      res.status(400).json({ error: "Invalid metadata on payment intent" });
      return;
    }

    const amountPaid = paymentIntent.amount_received / 100;

    try {
      await processConfirmedPayment(bookingId, agencyId, amountPaid);
      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[Stripe webhook] processConfirmedPayment failed:", err);
      res.status(500).json({ error: "Payment processing failed" });
    }
  }
);

// POST /webhooks/payment/:agencyId/khalti
// Khalti sends pidx + purchase_order_id (our bookingId) in the callback body
router.post("/:agencyId/khalti", async (req: Request, res: Response) => {
  const agencyId = req.params.agencyId as string;
  const { pidx, purchase_order_id: bookingId } = req.body as {
    pidx: string;
    purchase_order_id: string;
  };

  if (!pidx || !bookingId) {
    res.status(400).json({ error: "Missing pidx or purchase_order_id" });
    return;
  }

  const verified = await verifyKhaltiPayment(pidx);
  if (!verified) {
    res.status(400).json({ error: "Khalti payment verification failed" });
    return;
  }

  try {
    await processConfirmedPayment(bookingId, agencyId, verified.amount);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[Khalti webhook] processConfirmedPayment failed:", err);
    res.status(500).json({ error: "Payment processing failed" });
  }
});

// eSewa 
// POST /webhooks/payment/:agencyId/esewa
// eSewa sends a base64-encoded data param containing JSON + a signature
router.post("/:agencyId/esewa", async (req: Request, res: Response) => {
  const agencyId = req.params.agencyId as string;
  const { data } = req.body as { data: string };

  if (!data) {
    res.status(400).json({ error: "Missing eSewa data payload" });
    return;
  }

  let payload: {
    transaction_code: string;
    status: string;
    total_amount: string;
    transaction_uuid: string;
    product_code: string;
    signed_field_names: string;
    signature: string;
  };

  try {
    payload = JSON.parse(Buffer.from(data, "base64").toString("utf-8"));
  } catch {
    res.status(400).json({ error: "Invalid eSewa base64 payload" });
    return;
  }

  if (payload.status !== "COMPLETE") {
    res.status(200).json({ received: true, status: payload.status });
    return;
  }

  const secret = process.env.ESEWA_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ error: "eSewa secret not configured" });
    return;
  }

  // eSewa signature: HMAC-SHA256 of "field1,field2,...=value1,value2,..."
  const signedFields = payload.signed_field_names.split(",");
  const message = signedFields
    .map((field) => `${field}=${payload[field as keyof typeof payload]}`)
    .join(",");

  const isValid = verifyEsewaSignature(message, payload.signature, secret);
  if (!isValid) {
    res.status(400).json({ error: "Invalid eSewa signature" });
    return;
  }

  // transaction_uuid is our bookingId (set when creating eSewa payment request)
  const bookingId = payload.transaction_uuid;
  const amountPaid = parseFloat(payload.total_amount.replace(/,/g, ""));

  try {
    await processConfirmedPayment(bookingId, agencyId, amountPaid);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[eSewa webhook] processConfirmedPayment failed:", err);
    res.status(500).json({ error: "Payment processing failed" });
  }
});

// connectIps
// POST /webhooks/payment/:agencyId/connectips
router.post("/:agencyId/connectips", async (req: Request, res: Response) => {
  const agencyId = req.params.agencyId as string;
  const {
    TXNAMT,
    REFERENCEID,
    TXNID,
    STATUS,
    TOKEN,
  } = req.body as {
    TXNAMT: string;
    REFERENCEID: string; // our bookingId
    TXNID: string;
    STATUS: string;
    TOKEN: string;
  };

  if (STATUS !== "SUCCESS") {
    res.status(200).json({ received: true, status: STATUS });
    return;
  }

  const secret = process.env.CONNECTIPS_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ error: "ConnectIPS secret not configured" });
    return;
  }

  // ConnectIPS signature message format per their docs
  const message = `MERCHANTID=${process.env.CONNECTIPS_MERCHANT_ID},APPID=${process.env.CONNECTIPS_APP_ID},APPNAME=${process.env.CONNECTIPS_APP_NAME},TXNID=${TXNID},TXNDATE=${new Date().toISOString().split("T")[0]},TXNCRNCY=NPR,TXNAMT=${TXNAMT},REFERENCEID=${REFERENCEID},STATE=${STATUS},TOKEN=${TOKEN}`;

  const isValid = verifyConnectIPSSignature(message, TOKEN, secret);
  if (!isValid) {
    res.status(400).json({ error: "Invalid ConnectIPS signature" });
    return;
  }

  const amountPaid = parseFloat(TXNAMT) / 100;
  const bookingId = REFERENCEID;

  try {
    await processConfirmedPayment(bookingId, agencyId, amountPaid);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[ConnectIPS webhook] processConfirmedPayment failed:", err);
    res.status(500).json({ error: "Payment processing failed" });
  }
});

export default router;
