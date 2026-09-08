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
 * /agencies/me/widgets/youtube:
 *   patch: { tags: [Widgets], summary: Configure the YouTube video embeds, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 * /agencies/me/widgets/weather-enable:
 *   patch: { tags: [Widgets], summary: Toggle the weather widget, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 * /agencies/me/widgets/currency-enable:
 *   patch: { tags: [Widgets], summary: Toggle the currency-converter widget, security: [{ refreshToken: [] }], responses: { 200: { description: Updated } } }
 */
router.route('/')
    .get(authenticateWithRefreshToken, getWidgetsController);

router.route('/whatsapp')
    .patch(whatsappWidgetController);

router.route('/livechat')
    .patch(tierGate(["LARGE"]), livechatWidgetController);

router.route('/google')
    .patch(tierGate(["MEDIUM", "LARGE"]), googleAnalyticsWidgetController);

router.route('/facebook')
    .patch(tierGate(["MEDIUM", "LARGE"]), facebookPixelWidgetController);

router.route('/youtube')
    .patch(authenticateWithRefreshToken, tierGate(["MEDIUM", "LARGE"]), updateYoutubeWidgetController);

router.route('/instagram')
    .patch(tierGate(["LARGE"]), InstagramWidgetController);

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