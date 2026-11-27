import { db, type Db, type Tx } from "../../db/index.ts";
import * as hostSchema from "../../db/schema.ts";
import * as webmailSchema from "./schema.ts";

const schema = { ...hostSchema, ...webmailSchema };

export { db, schema, type Db, type Tx };
