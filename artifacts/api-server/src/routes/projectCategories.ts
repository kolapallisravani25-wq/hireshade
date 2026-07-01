import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

router.get("/", requireAuth, async (req, res) => {
  const roleType = req.query["role_type"] as string | undefined;
  const categories = [
    { id: "web", name: "Web Development", roleType: "engineer" },
    { id: "mobile", name: "Mobile Development", roleType: "engineer" },
    { id: "data", name: "Data Science", roleType: "data" },
    { id: "ml", name: "Machine Learning", roleType: "data" },
    { id: "devops", name: "DevOps", roleType: "engineer" },
    { id: "design", name: "Product Design", roleType: "designer" },
  ];
  const filtered = roleType
    ? categories.filter((c) => c.roleType === roleType)
    : categories;
  res.json({ data: filtered });
});

export default router;
