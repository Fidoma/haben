import { girocodePayload, type GirocodeInput } from "@haben/core";
import { encode } from "uqr";

/** QR-Code als SVG, Fehlerkorrektur M, ohne Rand; die Module als ein Pfad */
export function qrSvg(text: string): string {
  const { size, data } = encode(text, { ecc: "M", border: 0 });
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (data[y]?.[x]) path += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path fill="#000" d="${path}"/></svg>`;
}

/** GiroCode als SVG oder null, wenn die Angaben nicht für einen Code reichen */
export function girocodeSvg(input: GirocodeInput): string | null {
  const payload = girocodePayload(input);
  return payload ? qrSvg(payload) : null;
}
