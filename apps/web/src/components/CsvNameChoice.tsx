/*
 * Wahl zu einem Vorschlag aus DATEV-Stammdaten, der nur über den Namen passt (docs/csv-import.md, „Kontakte aus DATEV“):
 * Der Partner kann auch ein anderer mit gleichem Namen sein, deshalb zuordnen, als neuen Kontakt anlegen oder überspringen.
 */

export type Choice = "zuordnen" | "neu";
export type Choices = ReadonlyMap<number, Choice>;

const NAME_CHOICES: { value: Choice | null; label: string }[] = [
  { value: null, label: "Überspringen" },
  { value: "zuordnen", label: "Zuordnen" },
  { value: "neu", label: "Neu anlegen" },
];

export function NameChoice({
  line,
  title,
  value,
  busy,
  onChange,
}: {
  line: number;
  title: string;
  value: Choice | null;
  busy: boolean;
  onChange: (c: Choice | null) => void;
}) {
  return (
    <fieldset
      className="choice-group"
      style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 0, overflowWrap: "normal", hyphens: "auto", marginTop: 4 }}
      aria-describedby={`csv-hint-${line}`}
    >
      <legend className="visually-hidden">Gleicher Name: {title}</legend>
      {NAME_CHOICES.map((c) => (
        <label key={c.label} className="checkbox">
          <input type="radio" name={`csv-name-${line}`} checked={value === c.value} disabled={busy} onChange={() => onChange(c.value)} />
          {c.label}
        </label>
      ))}
    </fieldset>
  );
}
