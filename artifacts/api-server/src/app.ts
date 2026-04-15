import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT ?? "100mb";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

app.use("/api", router);

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type?: unknown }).type === "entity.too.large"
  ) {
    res.status(413).json({
      success: false,
      error: `Request payload too large. Reduce CSV size or set REQUEST_BODY_LIMIT (current: ${requestBodyLimit}).`,
    });
    return;
  }

  next(err);
});

export default app;
