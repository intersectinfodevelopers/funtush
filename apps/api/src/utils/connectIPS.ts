export interface ConnectIPSConfig {
  clientId: string;
  clientSecret: string;
}

export function getConnectIPSConfig(): ConnectIPSConfig {
  const clientId = process.env.CONNECTIPS_CLIENT_ID;
  const clientSecret = process.env.CONNECTIPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('ConnectIPS credentials not configured');
  }

  return { clientId, clientSecret };
}

export async function initiateConnectIPSTransfer(
  agencyId: string,
  amount: number,
  bankCode: string,
  accountNumber: string
) {
  const { clientId, clientSecret } = getConnectIPSConfig();

  try {
    const response = await fetch('https://api.connectips.com/api/transfer/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientId}:${clientSecret}`,
      },
      body: JSON.stringify({
        amount,
        bankCode,
        accountNumber,
        reference: agencyId,
        narration: `Funtush Subscription Payment`,
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!data.success) {
      throw new Error((data.message as string) || 'ConnectIPS transfer failed');
    }

    return {
      transferId: data.transferId as string,
      status: data.status as string,
    };
  } catch (err) {
    console.error('ConnectIPS transfer error:', err);
    throw err;
  }
}

export async function checkConnectIPSStatus(transferId: string): Promise<string> {
  const { clientId, clientSecret } = getConnectIPSConfig();

  try {
    const response = await fetch(
      `https://api.connectips.com/api/transfer/${transferId}/status/`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${clientId}:${clientSecret}`,
        },
      }
    );

    const data = (await response.json()) as Record<string, unknown>;
    return data.status as string;
  } catch (err) {
    console.error('ConnectIPS status check error:', err);
    throw err;
  }
}