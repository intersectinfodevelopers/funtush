export interface FonepayConfig {
  merchantCode: string;
  apiKey: string;
}

export function getFonepayConfig(): FonepayConfig {
  const merchantCode = process.env.FONEPAY_MERCHANT_CODE;
  const apiKey = process.env.FONEPAY_API_KEY;

  if (!merchantCode || !apiKey) {
    throw new Error('Fonepay credentials not configured');
  }

  return { merchantCode, apiKey };
}

export async function generateDynamicQRCode(
  agencyId: string,
  amount: number
): Promise<string> {
  const { merchantCode, apiKey } = getFonepayConfig();

  try {
    const response = await fetch('https://api.fonepay.com/api/v1/qr/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        merchant_code: merchantCode,
        amount,
        reference_id: agencyId,
        description: `Funtush Trek Booking - ${agencyId}`,
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!data.success) {
      throw new Error((data.message as string) || 'QR generation failed');
    }

    return data.qr_url as string;
  } catch (err) {
    console.error('Fonepay QR generation error:', err);
    throw err;
  }
}

export async function verifyFonepayTransaction(
  transactionId: string,
  amount: number
): Promise<boolean> {
  const { apiKey } = getFonepayConfig();

  try {
    const response = await fetch(
      `https://api.fonepay.com/api/v1/transaction/${transactionId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const data = (await response.json()) as Record<string, unknown>;
    return (
      data.status === 'SUCCESS' && (data.amount as number) === amount
    );
  } catch (err) {
    console.error('Fonepay verification error:', err);
    return false;
  }
}