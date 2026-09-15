import { Router } from "express";
import { convertCurrencyController, currencyConverterWidgetController } from "src/controllers/widgets/currencyConverter.controller";
import { InstagramWidgetController } from "src/controllers/widgets/instagram.controller";
import { weatherRequestController, weatherWidgetController } from "src/controllers/widgets/weather.controller";
import { facebookPixelWidgetController, getWidgetsController, googleAnalyticsWidgetController, livechatWidgetController, whatsappWidgetController } from "src/controllers/widgets/widgets.controller";
import { updateYoutubeWidgetController } from "src/controllers/widgets/youtube.controller";
import { authenticateWithRefreshToken } from "src/middleware/refreshTokenAuthentication";
import { tierGate } from "src/middleware/tierGateCheck.middleware";

const router = Router();

/**
 * SECURITY FIX: `whatsapp`/`livechat`/`google`/`facebook`/`instagram`
 * previously ran with no `authenticateWithRefreshToken` at all (whatsapp
 * had no guard whatsoever, not even `tierGate`). `tierGate` and every
 * controller here trust `req.tenantId`, but the *only* thing that set it
 * on these routes was `resolveTenant` — global middleware that resolves
 * purely from the unauthenticated `Host` header for public-site rendering.
 * That meant anyone could PATCH another agency's WhatsApp number, Google
 * Analytics ID, or Facebook Pixel just by sending the right `Host` header,
 * no session or token required. `authenticateWithRefreshToken` runs after
 * `resolveTenant` and overwrites `req.tenantId` with the verified,
 * session-derived value — added here to close that gap, matching the
 * already-correct `/youtube`, `/weather-*`, `/currency-*` routes below.
 */
/**
 * @openapi
 * /agencies/me/widgets:
 *   get:
 *     tags: [Widgets]
 *     summary: Get the agency's white-label site widget config
 *     security: [{ refreshToken: [] }]
 *     responses: { 200: { description: Widget config }, 401: { description: Unauthorized } }
 * /agencies/me/widgets/whatsapp:
 *   patch: { tags: [Widgets], summary: Configure the WhatsApp chat widget, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 * /agencies/me/widgets/google:
 *   patch: { tags: [Widgets], summary: "Set Google Analytics ID (Medium/Large tiers)", security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 403: { description: Tier gate } } }
 * /agencies/me/widgets/livechat:
 *   patch: { tags: [Widgets], summary: "Configure the live-chat widget (Large tier)", security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 403: { description: Tier gate } } }
 * /agencies/me/widgets/facebook:
 *   patch: { tags: [Widgets], summary: "Set the Facebook Pixel ID (Medium/Large tiers)", security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 403: { description: Tier gate } } }
 * /agencies/me/widgets/instagram:
 *   patch: { tags: [Widgets], summary: "Toggle the Instagram feed widget — requires a prior OAuth connection (Large tier)", security: [{ refreshToken: [] }], responses: { 200: { description: Updated }, 403: { description: Tier gate } } }
 * /agencies/me/widgets/youtube:
 *   patch: { tags: [Widgets], summary: Configure the YouTube video embeds, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 * /agencies/me/widgets/weather-enable:
 *   patch: { tags: [Widgets], summary: Toggle the weather widget, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 * /agencies/me/widgets/weather-check:
 *   get: { tags: [Widgets], summary: "Fetch current weather for the agency's location (Medium/Large tiers)", security: [{ refreshToken: [] }], responses: { 200: { description: Weather } } }
 * /agencies/me/widgets/currency-enable:
 *   patch: { tags: [Widgets], summary: Toggle the currency-converter widget, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 * /agencies/me/widgets/currency-check:
 *   patch: { tags: [Widgets], summary: "Convert an amount between currencies (Medium/Large tiers)", security: [{ refreshToken: [] }], responses: { 200: { description: Converted } } }
 */
router.route('/')
    .get(authenticateWithRefreshToken, getWidgetsController);

router.route('/whatsapp')
    .patch(authenticateWithRefreshToken, whatsappWidgetController);

router.route('/livechat')
    .patch(authenticateWithRefreshToken, tierGate(["LARGE"]), livechatWidgetController);

router.route('/google')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), googleAnalyticsWidgetController);

router.route('/facebook')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), facebookPixelWidgetController);

router.route('/youtube')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), updateYoutubeWidgetController);

router.route('/instagram')
    .patch(authenticateWithRefreshToken, tierGate(["LARGE"]), InstagramWidgetController);

router.route('/weather-enable')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), weatherWidgetController);
router.route('/weather-check')
    .get(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), weatherRequestController);

router.route('/currency-enable')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), currencyConverterWidgetController);

router.route('/currency-check')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), convertCurrencyController);


// ["FREE","MEDIUM","LARGE"]
export default router;