import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  ListPropertiesResponse,
  CreatePropertyBody,
  CreatePropertyResponse,
  UpdatePropertyParams,
  UpdatePropertyBody,
  UpdatePropertyResponse,
  DeletePropertyParams,
  ListFlatsQueryParams,
  ListFlatsResponse,
  CreateFlatBody,
  CreateFlatResponse,
  UpdateFlatParams,
  UpdateFlatBody,
  UpdateFlatResponse,
  DeleteFlatParams,
  ListFlatPaymentsParams,
  ListFlatPaymentsResponse,
  CreatePaymentParams,
  CreatePaymentBody,
  CreatePaymentResponse,
  GetDashboardSummaryResponse,
  ListActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const asNumber = (value: string | number | null) => Number(value ?? 0);
const isoDate = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
const isoTimestamp = (value: Date | string) => new Date(value).toISOString();

router.get("/properties", async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT p.*, COUNT(f.id)::int AS unit_count
      FROM properties p LEFT JOIN flats f ON f.property_id = p.id AND f.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      GROUP BY p.id ORDER BY p.created_at DESC`);
    res.json(ListPropertiesResponse.parse(result.rows.map((row) => ({
      id: row.id, createdAt: isoTimestamp(row.created_at), name: row.name,
      address: row.address, unitCount: row.unit_count,
    }))));
  } catch (error) { return next(error); }
});

router.post("/properties", async (req, res, next) => {
  try {
    const input = CreatePropertyBody.parse(req.body);
    const result = await pool.query(
      "INSERT INTO properties (name, address) VALUES ($1, $2) RETURNING *",
      [input.name, input.address],
    );
    const row = result.rows[0];
    res.status(201).json(CreatePropertyResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), name: row.name, address: row.address, unitCount: 0,
    }));
  } catch (error) { return next(error); }
});

router.patch("/properties/:id", async (req, res, next) => {
  try {
    const { id } = UpdatePropertyParams.parse(req.params);
    const input = UpdatePropertyBody.parse(req.body);
    const result = await pool.query(
      "UPDATE properties SET name = COALESCE($1, name), address = COALESCE($2, address) WHERE id = $3 AND deleted_at IS NULL RETURNING *",
      [input.name ?? null, input.address ?? null, id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Property not found" });
    const row = result.rows[0];
    return res.json(UpdatePropertyResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), name: row.name, address: row.address, unitCount: 0,
    }));
  } catch (error) { return next(error); }
});

router.delete("/properties/:id", async (req, res, next) => {
  try {
    const { id } = DeletePropertyParams.parse(req.params);
    // Soft delete: the property (and its units, below) drop out of the active
    // workspace, but the rows - and every payment that references them -
    // stay in place so past records are never lost.
    const result = await pool.query(
      "UPDATE properties SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (result.rowCount) {
      await pool.query(
        "UPDATE flats SET deleted_at = now() WHERE property_id = $1 AND deleted_at IS NULL",
        [id],
      );
    }
    res.status(204).send();
  } catch (error) { return next(error); }
});

router.get("/flats", async (req, res, next) => {
  try {
    const { propertyId } = ListFlatsQueryParams.parse(req.query);
    const result = await pool.query(`
      SELECT f.*, p.name AS property_name, COALESCE(SUM(pay.amount), 0) AS total_paid,
        MAX(pay.payment_date) AS last_payment_date
      FROM flats f JOIN properties p ON p.id = f.property_id
      LEFT JOIN payments pay ON pay.flat_id = f.id
      WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL
      ${propertyId ? "AND f.property_id = $1" : ""}
      GROUP BY f.id, p.name ORDER BY f.flat_no ASC
    `, propertyId ? [propertyId] : []);
    res.json(ListFlatsResponse.parse(result.rows.map((row) => ({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: row.property_name,
      flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id,
      moveInDate: isoDate(row.move_in_date), deposit: asNumber(row.deposit), rent: asNumber(row.rent),
      totalPaid: asNumber(row.total_paid), lastPaymentDate: row.last_payment_date ? isoDate(row.last_payment_date) : null,
    }))));
  } catch (error) { return next(error); }
});

router.post("/flats", async (req, res, next) => {
  try {
    const input = CreateFlatBody.parse(req.body);
    const result = await pool.query(
      `INSERT INTO flats (property_id, flat_no, tenant_name, workplace, govt_id, move_in_date, deposit, rent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.propertyId, input.flatNo, input.tenantName, input.workplace, input.govtId, input.moveInDate, input.deposit, input.rent],
    );
    const row = result.rows[0];
    const property = await pool.query("SELECT name FROM properties WHERE id = $1", [row.property_id]);
    res.status(201).json(CreateFlatResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: property.rows[0]?.name ?? "",
      flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id,
      moveInDate: isoDate(row.move_in_date), deposit: asNumber(row.deposit), rent: asNumber(row.rent), totalPaid: 0, lastPaymentDate: null,
    }));
  } catch (error) { next(error); }
});

router.patch("/flats/:id", async (req, res, next) => {
  try {
    const { id } = UpdateFlatParams.parse(req.params);
    const input = UpdateFlatBody.parse(req.body);
    const result = await pool.query(
      `UPDATE flats SET flat_no=COALESCE($1,flat_no), tenant_name=COALESCE($2,tenant_name), workplace=COALESCE($3,workplace),
       govt_id=COALESCE($4,govt_id), move_in_date=COALESCE($5,move_in_date), deposit=COALESCE($6,deposit), rent=COALESCE($7,rent)
       WHERE id=$8 AND deleted_at IS NULL RETURNING *`,
      [input.flatNo ?? null, input.tenantName ?? null, input.workplace ?? null, input.govtId ?? null, input.moveInDate ?? null, input.deposit ?? null, input.rent ?? null, id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Flat not found" });
    const row = result.rows[0];
    const property = await pool.query("SELECT name FROM properties WHERE id = $1", [row.property_id]);
    return res.json(UpdateFlatResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), propertyId: row.property_id, propertyName: property.rows[0]?.name ?? "",
      flatNo: row.flat_no, tenantName: row.tenant_name, workplace: row.workplace, govtId: row.govt_id,
      moveInDate: isoDate(row.move_in_date), deposit: asNumber(row.deposit), rent: asNumber(row.rent), totalPaid: 0, lastPaymentDate: null,
    }));
  } catch (error) { return next(error); }
});

router.delete("/flats/:id", async (req, res, next) => {
  try {
    const { id } = DeleteFlatParams.parse(req.params);
    // Soft delete: the unit/tenant drops out of the active ledger, but its
    // row - and every payment recorded against it - stays in place.
    await pool.query("UPDATE flats SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL", [id]);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.get("/flats/:id/payments", async (req, res, next) => {
  try {
    const { id } = ListFlatPaymentsParams.parse(req.params);
    const result = await pool.query("SELECT * FROM payments WHERE flat_id=$1 ORDER BY payment_date DESC", [id]);
    res.json(ListFlatPaymentsResponse.parse(result.rows.map((row) => ({
      id: row.id, createdAt: isoTimestamp(row.created_at), flatId: row.flat_id, paymentDate: isoDate(row.payment_date), amount: asNumber(row.amount),
    }))));
  } catch (error) { next(error); }
});

router.post("/flats/:id/payments", async (req, res, next) => {
  try {
    const { id } = CreatePaymentParams.parse(req.params);
    const input = CreatePaymentBody.parse(req.body);
    const flat = await pool.query("SELECT id FROM flats WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!flat.rowCount) return res.status(404).json({ error: "Flat not found" });
    const result = await pool.query("INSERT INTO payments (flat_id, payment_date, amount) VALUES ($1,$2,$3) RETURNING *", [id, input.paymentDate, input.amount]);
    const row = result.rows[0];
    return res.status(201).json(CreatePaymentResponse.parse({
      id: row.id, createdAt: isoTimestamp(row.created_at), flatId: row.flat_id, paymentDate: isoDate(row.payment_date), amount: asNumber(row.amount),
    }));
  } catch (error) { return next(error); }
});

router.get("/dashboard/summary", async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT
      COALESCE(SUM(rent),0) AS expected, COUNT(*) FILTER (WHERE tenant_name <> '')::int AS occupied,
      COUNT(*)::int AS total_units, (SELECT COUNT(*)::int FROM properties WHERE deleted_at IS NULL) AS properties_count,
      COALESCE((SELECT SUM(amount) FROM payments),0) AS collected,
      COUNT(*) FILTER (WHERE move_in_date <= CURRENT_DATE - INTERVAL '11 months')::int AS due
      FROM flats WHERE deleted_at IS NULL`);
    const row = result.rows[0];
    res.json(GetDashboardSummaryResponse.parse({
      expectedMonthlyRevenue: asNumber(row.expected), totalCollected: asNumber(row.collected), occupiedUnits: row.occupied,
      totalUnits: row.total_units, propertiesCount: row.properties_count, dueForRevision: row.due,
    }));
  } catch (error) { next(error); }
});

router.get("/activity", async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT id::text, 'payment' AS type, 'Payment recorded' AS title,
      'A new rent payment was added to the ledger' AS description, created_at FROM payments
      ORDER BY created_at DESC LIMIT 8`);
    res.json(ListActivityResponse.parse(result.rows.map((row) => ({
      id: row.id, type: row.type, title: row.title, description: row.description, createdAt: isoTimestamp(row.created_at),
    }))));
  } catch (error) { next(error); }
});

export default router;
