import { Router } from "express";
import { pool } from "@workspace/db";

export const queryRouter = Router();

queryRouter.get("/csv-imports", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM csv_imports");
    res.json(result.rows);
  } catch (error) {
    console.error("Error querying csv_imports", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
