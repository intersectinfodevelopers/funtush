import { db } from "@funtush/database";

const bad = (m: string): never => {
    throw new Error(m);
};

/** Optional nullable string field: undefined = leave alone, ""/null = clear. */
const optText = (v: unknown, label: string, max: number): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") return bad(`${label} must be text.`);
    const t = v.trim();
    if (t.length > max) return bad(`${label} is too long (max ${max} characters).`);
    return t === "" ? null : t;
};

const optBool = (v: unknown, label: string): boolean | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") return bad(`${label} must be true or false.`);
    return v;
};


interface whatsappWidgetPayload {
    whatsappEnabled?: boolean;
    whatsappNumber?: string;
};

interface chatWidgetPayload {
    liveChatEnabled?: boolean;
    liveChatCode?: string;
};

interface googleAnalyticsWidgetPayload {
    googleAnalyticsId?: string;
};

interface facebookPixelWidgetPayload {
    facebookPixelId?: string;
};

export const whatsappWidgetService = async (
    agencyUserId: string,
    data: whatsappWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    // Only these two columns are writable here. The body is never spread into the
    // profile: that would let a caller flip tier-gated flags (live chat, YouTube limits…).
    const whatsappEnabled = optBool(data?.whatsappEnabled, "whatsappEnabled");
    const whatsappNumber = optText(data?.whatsappNumber, "WhatsApp number", 20);
    if (whatsappNumber && !/^\+?\d{7,15}$/.test(whatsappNumber)) {
        throw new Error("WhatsApp number must be 7-15 digits, optionally starting with +.");
    }
    if (whatsappEnabled && !whatsappNumber) {
        const existing = await db.agencyProfile.findUnique({ where: { agencyId: agencyUser.agencyId }, select: { whatsappNumber: true } });
        if (whatsappNumber === undefined && existing?.whatsappNumber) {
            /* keep the stored number */
        } else {
            throw new Error("WhatsApp number is required.");
        }
    }

    const profile = await db.agencyProfile.upsert({
        where: { agencyId: agencyUser.agencyId },
        update: {
            whatsappEnabled,
            whatsappNumber,
        },
        create: { agencyId: agencyUser.agencyId,
            whatsappEnabled,
            whatsappNumber,
        },
    });

    return profile;
};

export const livechatWidgetService = async (
    agencyUserId: string,
    data: chatWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    // if (
    //     data.liveChatEnabled &&
    //     agency.tier.name !== "LARGE"
    // ) {
    //     throw new Error("Live Chat feature is only available for Large tier.");
    // }

    // The embed snippet is published on the agency's own site by design, so it's
    // kept as given — but bounded, and only these two columns are writable.
    const liveChatEnabled = optBool(data?.liveChatEnabled, "liveChatEnabled");
    const liveChatCode = optText(data?.liveChatCode, "Live chat code", 5000);
    if (liveChatEnabled && !liveChatCode) {
        throw new Error("Live Chat embed code is required.");
    }

    const profile = await db.agencyProfile.upsert({
        where: { agencyId: agencyUser.agencyId },
        update: {
            liveChatEnabled,
            liveChatCode
        },
        create: { agencyId: agencyUser.agencyId,
            liveChatEnabled,
            liveChatCode
        },
    });

    return profile;
};

export const googleAnalyticsWidgetService = async (
    agencyUserId: string,
    data: googleAnalyticsWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    // if (
    //     data.googleAnalyticsId &&
    //     agency.tier.name !== "MEDIUM" &&
    //     agency.tier.name !== "LARGE"
    // ) {
    //     throw new Error(
    //         "Google Analytics is available only for Medium and Large plans."
    //     );
    // }

    const gaId = optText(data?.googleAnalyticsId, "Google Analytics ID", 30);
    // Measurement IDs are interpolated into a script on the public site: fixed formats only.
    if (gaId && !/^(G|GT|AW|UA)-[A-Z0-9-]{4,20}$/i.test(gaId)) {
        throw new Error("Google Analytics ID must look like G-XXXXXXXXXX.");
    }
    const profile = await db.agencyProfile.upsert({
        where: { agencyId: agencyUser.agencyId },
        update: {
            googleAnalyticsId: gaId,
        },
        create: { agencyId: agencyUser.agencyId,
            googleAnalyticsId: gaId,
        },
    });

    return profile;
};

export const facebookPixelWidgetService = async (
    agencyUserId: string,
    data: facebookPixelWidgetPayload
) => {
    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    const agency = await db.agency.findUnique({
        where: {
            id: agencyUser.agencyId
        },
        select: {
            tier: {
                select: {
                    name: true
                }
            }
        }
    });

    if (!agency) {
        throw new Error("Agency not found");
    }

    // if (
    //     data.facebookPixelId &&
    //     agency.tier.name !== "MEDIUM" &&
    //     agency.tier.name !== "LARGE"
    // ) {
    //     throw new Error(
    //         "Facebook pixel is available only for Medium and Large plans."
    //     );
    // }

    const pixelId = optText(data?.facebookPixelId, "Facebook Pixel ID", 20);
    if (pixelId && !/^\d{5,20}$/.test(pixelId)) {
        throw new Error("Facebook Pixel ID must be 5-20 digits.");
    }
    const profile = await db.agencyProfile.upsert({
        where: { agencyId: agencyUser.agencyId },
        update: {
            facebookPixelId: pixelId,
        },
        create: { agencyId: agencyUser.agencyId,
            facebookPixelId: pixelId,
        },
    });

    return profile;
};

export const getWidgetsService = async (
    agencyUserId: string
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId,
        },
        select: {
            agencyId: true,
        },
    });

    if (!agencyUser) {
        throw new Error("Agency user not found.");
    }

    const profile = await db.agencyProfile.findUnique({
        where: {
            agencyId: agencyUser.agencyId,
        },
        select: {
            whatsappEnabled: true,
            whatsappNumber: true,

            googleMapsEnabled: true,

            liveChatEnabled: true,
            liveChatCode: true,

            googleAnalyticsId: true,

            facebookPixelId: true,

            instagramConnected: true,
            instagramFeedEnabled: true,

            currencyConverterEnabled: true,
            
            weatherWidgetEnabled: true,

            youtubeEnabled: true,
            youtubeVideos: true,
            maxYoutubeVideos: true,
        },
    });

    return {
        whatsapp: {
            enabled: profile?.whatsappEnabled,
            number: profile?.whatsappNumber,
        },

        googleMaps: {
            enabled: profile?.googleMapsEnabled,
        },

        liveChat: {
            enabled: profile?.liveChatEnabled,
            code: profile?.liveChatCode,
        },

        weather: {
            enabled: profile?.weatherWidgetEnabled,
        },

        currencyConverter: {
            enabled: profile?.currencyConverterEnabled,
        },

        youtube: {
            enabled: profile?.youtubeEnabled,
            videos: profile?.youtubeVideos,
            maxVideos: profile?.maxYoutubeVideos,
        },

        googleAnalytics: {
            id: profile?.googleAnalyticsId,
        },

        facebookPixel: {
            id: profile?.facebookPixelId,
        },

        instagram: {
            connected: profile?.instagramConnected,
            feedEnabled: profile?.instagramFeedEnabled,
        },
    };
};

