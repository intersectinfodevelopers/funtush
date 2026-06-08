import { jwtPayload } from "@funtush/auth";

declare global {
  namespace Express {
    interface Request {
      user?: jwtPayload;
    }
  }
}

export {};