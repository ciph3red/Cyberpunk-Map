import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wigleRouter from "./wigle";
import csvImportsRouter from "./csv-imports";
import { queryRouter } from "./query";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wigleRouter);
router.use(csvImportsRouter);
router.use("/query", queryRouter);

export default router;
