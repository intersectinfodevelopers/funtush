export interface KhaltiConfig {
  publicKey: string;
  secretKey: string;
}

export function getKhaltiConfig(): KhaltiConfig {
  const publicKey = process.env.KHALTI_PUBLIC_KEY;
  const secretKey = process.env.KHALTI_SECRET_KEY;

  if (!publicKey || !secretKey) {
    throw new Error('Khalti credentials not configured');
  }

  return { publicKey, secretKey };
}

export function generateKhaltiPayload(
  agencyId: string,
  amount: number,
  tierId: string
) {
  const { publicKey } = getKhaltiConfig();

  return {
    public_key: publicKey,
    amount: amount * 100,
    product_identity: tierId,
    product_name: `Funtush Subscription - Tier ${tierId}`,
    product_url: `${process.env.FRONTEND_URL}/billing`,
    merchant_username: 'funtush',
    return_url: `${process.env.API_URL}/billing/subscribe/verify?provider=khalti&agencyId=${agencyId}`,
    webhook_url: `${process.env.API_URL}/webhooks/khalti`,
  };
}

export async function verifyKhaltiPayment(
  token: string,
  amount: number
): Promise<boolean> {
  const { secretKey } = getKhaltiConfig();

  try {
    const response = await fetch('https://khalti.com/api/v2/payment/verify/', {
      method: 'POST',
      headers: {
        Authorization: `Key ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        amount,
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    return data.success === true;
  } catch (err) {
    console.error('Khalti verification error:', err);
    return false;
  }
}