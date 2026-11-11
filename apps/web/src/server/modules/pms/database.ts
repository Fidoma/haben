import { db, type Db, type Tx } from "../../db/index.ts";
import * as hostSchema from "../../db/schema.ts";
import * as pmsSchema from "./schema.ts";

/** Lokale Datenbanksicht: gemeinsame Hosttabellen nur für die beiden Adapter, PMS-Tabellen für die Fachlogik. */
const schema = { ...hostSchema, ...pmsSchema };

export { db, schema, type Db, type Tx };
