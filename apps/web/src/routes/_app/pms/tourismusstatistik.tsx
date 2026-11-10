import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TourismStatistics } from "../../../components/pms/TourismStatistics.tsx";
import { getPmsTourismReport } from "../../../server/functions/pms.ts";

const now = new Date();
const searchSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200).catch(now.getFullYear()),
  month: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .catch(now.getMonth() + 1),
});

export const Route = createFileRoute("/_app/pms/tourismusstatistik")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getPmsTourismReport({ data: deps }),
  head: () => ({ meta: [{ title: "Tourismusstatistik · Haben" }] }),
  component: TourismPage,
});

function TourismPage() {
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">PMS</div>
          <h1>Tourismusstatistik</h1>
        </div>
      </div>
      <TourismStatistics initial={loaded} year={search.year} month={search.month} />
    </>
  );
}
