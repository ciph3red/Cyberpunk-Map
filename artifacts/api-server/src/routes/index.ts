import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wigleRouter from "./wigle";
import csvImportsRouter from "./csv-imports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wigleRouter);
router.use(csvImportsRouter);

export default router;
