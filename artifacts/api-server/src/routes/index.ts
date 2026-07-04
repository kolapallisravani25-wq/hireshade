import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import sessionsRouter from "./sessions.js";
import creditsRouter from "./credits.js";
import resumesRouter from "./resumes.js";
import documentsRouter from "./documents.js";
import questionBankRouter from "./questionBank.js";
import projectsRouter from "./projects.js";
import aiRouter from "./ai.js";
import projectCategoriesRouter from "./projectCategories.js";
import assistantRouter from "./assistant.js";
import askAIRouter from "./askAI.js";
import sessionNotesRouter from "./sessionNotes.js";
import desktopRouter from "./desktop.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/session", sessionsRouter);
router.use("/session-notes", sessionNotesRouter);
router.use("/ask-ai", askAIRouter);
router.use("/credits", creditsRouter);
router.use("/resume", resumesRouter);
router.use("/document", documentsRouter);
router.use("/question-bank", questionBankRouter);
router.use("/projects", projectsRouter);
router.use("/ai", aiRouter);
router.use("/project-categories", projectCategoriesRouter);
router.use("/assistant", assistantRouter);
router.use("/desktop", desktopRouter);

export default router;
