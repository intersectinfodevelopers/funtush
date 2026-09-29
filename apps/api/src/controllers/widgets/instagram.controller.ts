import type { Request, Response } from "express";
import axios from "axios";
import crypto from "node:crypto";
import { redis } from "../../lib/redis";
import { instagramWidgetService, saveInstagramConnectionService } from "src/services/widgets/instagram.service";

export const InstagramWidgetController = async (
    req: Request,
    res: Response
) => {
    try {
        const agencyUserId = req.tenantId as string;

        const instagram = await instagramWidgetService(
            agencyUserId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: instagram,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            message:
                err instanceof Error
                    ? err.message
                    : "Something went wrong",
        });
    }
};

// OAuth `state` must be unguessable and bound, server-side, to the agency that
// STARTED the flow. It used to be the raw agencyId, and the callback trusted it
// as "the agency to attach this Instagram account to" — so anyone who knew an
// agency's id could complete OAuth with their own Instagram account, then call
// the callback with `state=<victim agencyId>` and plant their account (feed,
// tokens) on the victim's site.
const INSTAGRAM_STATE_TTL_SECONDS = 10 * 60;
const instagramStateKey = (state: string) => `instagram-oauth-state:${state}`;

// Redirect to Instagram login
export const connectInstagramController = async (
    req: Request,
    res: Response
) => {

    const agencyId = req.agencyId as string;

    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;

    const scopes = [
        'instagram_business_basic',
        'instagram_business_content_publish', // Include extra permissions if publishing
        'instagram_business_manage_messages',   // Include if building a DM bot
        'instagram_business_manage_comments',
    ].join(',');

    const state = crypto.randomBytes(24).toString("hex");
    await redis.set(instagramStateKey(state), agencyId, "EX", INSTAGRAM_STATE_TTL_SECONDS);

    const url =
        `https://www.instagram.com/oauth/authorize` +
        `?client_id=${process.env.INSTAGRAM_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&response_type=code` +
        `&state=${state}`;

    return res.redirect(url);
};

// After login -> recieves authorization code
export const instagramCallbackController = async (
    req: Request,
    res: Response
) => {
    try {

        const code = req.query.code;
        const state = req.query.state;

        if (typeof code !== "string" || !code) {
            return res.status(400).json({
                success: false,
                message: "Authorization code missing."
            });
        }
        if (typeof state !== "string" || !/^[a-f0-9]{48}$/.test(state)) {
            return res.status(400).json({ success: false, message: "Invalid or expired OAuth state." });
        }

        // One-time: GETDEL so a state can never be replayed, and the agency comes
        // from OUR record of who started the flow, never from the request.
        const agencyId = await redis.getdel(instagramStateKey(state));
        if (!agencyId) {
            return res.status(400).json({ success: false, message: "Invalid or expired OAuth state." });
        }

        //---------------------------------------
        // Exchange authorization code for Short-Lived token
        //---------------------------------------
        //returns userid, accesstoken, permissions
        const shortLivedResponse = await axios.post(
            'https://api.instagram.com/oauth/access_token',
            {
                params: {
                    client_id: process.env.INSTAGRAM_APP_ID,
                    client_secret: process.env.INSTAGRAM_APP_SECRET,
                    grant_type: "authorization_code",
                    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
                    code: code.toString()
                }
            }
        );

        const shortLivedToken = shortLivedResponse.data.access_token;
        const instagramUserId = shortLivedResponse.data.user_id;


        // Exchange for Long-Lived Token (60 days)
        const longLivedResponse = await axios.get(
            `https://graph.instagram.com/access_token`,
            {
                params: {
                    grant_type: "ig_exchange_token",
                    client_secret:
                        process.env.INSTAGRAM_APP_SECRET,
                    access_token: shortLivedToken
                }
            }
        );

        const longLivedToken = longLivedResponse.data.access_token;
        const expiresIn = longLivedResponse.data.expires_in; // Seconds until expiration
        const expiresAt = new Date(
            Date.now() + expiresIn * 1000
        );


        //---------------------------------------
        // Save the data
        //---------------------------------------
        await saveInstagramConnectionService(agencyId, {
            instagramBusinessId:
                instagramUserId,
            instagramAccessToken:
                longLivedToken,
            instagramTokenExpiresAt:
                expiresAt
        });

        return res.status(200).json({
            success: true,
            message: "Instagram connected successfully."
        });

    } catch (err) {
        console.error("[Instagram OAuth] callback failed:", err);
        return res.status(500).json({ success: false, message: "Instagram OAuth failed." });
    }
};

// Refresh Token -> new token
export const refreshInstagramToken = async (
    accessToken: string
) => {

    const response = await axios.get(
        "https://graph.instagram.com/refresh_access_token",
        {
            params: {
                grant_type: "ig_refresh_token",
                access_token: accessToken
            }
        }
    );

    return response.data;
};

