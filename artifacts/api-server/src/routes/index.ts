import { Router, type IRouter } from "express";
import healthRouter from "./health";
import propflowRouter from "./propflow";

const router: IRouter = Router();

router.use(healthRouter);
router.use(propflowRouter);

export default router;
