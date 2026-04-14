import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wigleRouter from "./wigle";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wigleRouter);

export default router;
