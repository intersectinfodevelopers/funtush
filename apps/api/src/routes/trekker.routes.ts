import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import { registerTrekker, trekkerPreference } from "src/controllers/Trekkers/trekker.controller";
import { getMyTrekkerProfile, updateMyTrekkerProfile } from "../services/trekkerProfile.service";
import { listSavedDestinations, saveDestination, unsaveDestination } from "../services/trekkerSavedDestinations.service";
import { listMyNotifications, markRead, unreadCount } from "../services/trekkerNotifications.service";

const router = Router();

/**
 * SECURITY FIX: `PATCH /trekker-preferences` previously had **no auth at
 * all**, and took a `trekkerId` straight from the request body — any
 * caller could overwrite any other trekker's saved preferences (an IDOR
 * on top of having no auth to begin with). `requireRole(["TREKKER"])`
 * matches `mobile.routes.ts`'s own convention for trekker-only endpoints;
 * the controller now resolves the trekker id from the verified session
 * instead of trusting the body.
 */
/**
 * @openapi
 * /create/trekker:
 *   post: { tags: [Trekkers], summary: "Public: register a new trekker account", responses: { 201: { description: Registered }, 409: { description: Email already exists } } }
 * /trekker/me:
 *   get: { tags: [Trekkers], summary: The signed-in trekker's own profile, security: [{ bearerAuth: [] }], responses: { 200: { description: Profile }, 401: { description: Unauthorized } } }
 *   patch: { tags: [Trekkers], summary: Update the signed-in trekker's own profile (name, phone, country, nationality, emergency contact), security: [{ bearerAuth: [] }], responses: { 200: { description: Saved }, 400: { description: Validation failed } } }
 * /trekker/notifications:
 *   get: { tags: [Trekkers], summary: The signed-in trekker's in-app notifications (newest first) with the unread count, security: [{ bearerAuth: [] }], parameters: [{ name: page, in: query, schema: { type: integer } }], responses: { 200: { description: Notifications } } }
 * /trekker/notifications/unread-count:
 *   get: { tags: [Trekkers], summary: Unread notification count, security: [{ bearerAuth: [] }], responses: { 200: { description: Count } } }
 * /trekker/notifications/read:
 *   post: { tags: [Trekkers], summary: Mark notifications read (body ids, or omit to mark all), security: [{ bearerAuth: [] }], responses: { 200: { description: Updated } } }
 * /trekker/saved-destinations:
 *   get: { tags: [Trekkers], summary: The signed-in trekker's saved (wishlisted) destinations, security: [{ bearerAuth: [] }], responses: { 200: { description: Saved destinations }, 401: { description: Unauthorized } } }
 * /trekker/saved-destinations/{id}:
 *   put: { tags: [Trekkers], summary: Save a destination (idempotent), security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Saved }, 404: { description: Destination not found } } }
 *   delete: { tags: [Trekkers], summary: Remove a saved destination, security: [{ bearerAuth: [] }], parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { 200: { description: Removed } } }
 * /trekker-preferences:
 *   patch: { tags: [Trekkers], summary: Set the signed-in trekker's own travel preferences (destinations, budget, group size), security: [{ bearerAuth: [] }], responses: { 200: { description: Saved }, 401: { description: Unauthorized } } }
 */
router.route('/create/trekker')
    .post(registerTrekker);

const fail = (res: import("express").Response, err: unknown) => {
    const status = (err as { status?: number })?.status ?? 500;
    if (status >= 500) console.error("[trekker profile]", err);
    return res.status(status).json({ success: false, message: status >= 500 ? "Request failed" : (err as Error).message });
};
router.route('/trekker/me')
    .get(requireAuth, requireRole(["TREKKER"]), async (req, res) => {
        try {
            res.json({ success: true, data: await getMyTrekkerProfile(req.user!.userId) });
        } catch (err) { fail(res, err); }
    })
    .patch(requireAuth, requireRole(["TREKKER"]), async (req, res) => {
        try {
            res.json({ success: true, data: await updateMyTrekkerProfile(req.user!.userId, (req.body ?? {}) as Record<string, unknown>) });
        } catch (err) { fail(res, err); }
    });

const only = [requireAuth, requireRole(["TREKKER"])] as const;
router.get('/trekker/notifications', ...only, async (req, res) => {
    try { res.json({ success: true, data: await listMyNotifications(req.user!.userId, Number(req.query.page)) }); } catch (err) { fail(res, err); }
});
router.get('/trekker/notifications/unread-count', ...only, async (req, res) => {
    try { res.json({ success: true, data: { unread: await unreadCount(req.user!.userId) } }); } catch (err) { fail(res, err); }
});
router.post('/trekker/notifications/read', ...only, async (req, res) => {
    try { res.json({ success: true, data: await markRead(req.user!.userId, req.body?.ids) }); } catch (err) { fail(res, err); }
});

router.get('/trekker/saved-destinations', ...only, async (req, res) => {
    try { res.json({ success: true, data: await listSavedDestinations(req.user!.userId) }); } catch (err) { fail(res, err); }
});
router.put('/trekker/saved-destinations/:id', ...only, async (req, res) => {
    try { res.json({ success: true, data: await saveDestination(req.user!.userId, String(req.params.id)) }); } catch (err) { fail(res, err); }
});
router.delete('/trekker/saved-destinations/:id', ...only, async (req, res) => {
    try { res.json({ success: true, data: await unsaveDestination(req.user!.userId, String(req.params.id)) }); } catch (err) { fail(res, err); }
});

router.route('/trekker-preferences')
    .patch(requireAuth, requireRole(["TREKKER"]), trekkerPreference);

export default router;