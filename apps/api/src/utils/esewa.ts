export interface EsewaConfig {
  merchantCode: string;
  merchantSecret: string;
}

export function getEsewaConfig(): EsewaConfig {
  const merchantCode = process.env.ESEWA_MERCHANT_CODE;
  const merchantSecret = process.env.ESEWA_MERCHANT_SECRET;

  if (!merchantCode || !merchantSecret) {
    throw new Error('eSewa credentials not configured');
  }

  return { merchantCode, merchantSecret };
}

export function generateEsewaPayload(
  agencyId: string,
  amount: number,
  tierId: string
) {
  const { merchantCode } = getEsewaConfig();
  const transactionUUID = `${agencyId}-${Date.now()}`;

  return {
    amt: amount,
    psc: 0,
    pdc: 0,
    txAmt: 0,
    tAmt: amount,
    pid: tierId,
    scd: merchantCode,
    su: `${process.env.FRONTEND_URL}/billing/success?provider=esewa&agencyId=${agencyId}&txId=${transactionUUID}`,
    fu: `${process.env.FRONTEND_URL}/billing/failed?provider=esewa&agencyId=${agencyId}`,
  };
}

export async function verifyEsewaPayment(
  refId: string,
  amount: number
): Promise<boolean> {
  const { merchantCode } = getEsewaConfig();

  try {
    const response = await fetch(
      'https://esewa.com.np/api/v1/transaction/status/',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refId,
          merchantCode,
          amount,
        }),
      }
    );

    const data = (await response.json()) as Record<string, unknown>;
    return data.status === 'COMPLETE';
  } catch (err) {
    console.error('eSewa verification error:', err);
    return false;
  }
}