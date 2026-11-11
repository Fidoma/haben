import { formatEuro } from "@haben/core";
import { useState } from "react";
import type { ArticleOption } from "../ArticleCombobox.tsx";
import { Combobox, type ComboboxOption } from "../Combobox.tsx";
import { searchOptions } from "../../lib/combobox.ts";

const articleFields = (article: ArticleOption) => [article.description, article.number];

function describeArticle(article: ArticleOption): ComboboxOption {
  const price = `${formatEuro(article.unitPrice)} ${article.priceIncludesTax ? "brutto" : "netto"} je ${article.unit}`;
  return { key: article.id, label: article.description, meta: article.number ? `${article.number} · ${price}` : price };
}

/** Durchsuchbare, kontrollierte Artikelauswahl ausschließlich für Reservierungspositionen. */
export function ArticleSelectCombobox({
  label,
  articleId,
  articles,
  disabled,
  onPick,
}: {
  label: string;
  articleId: string;
  articles: ArticleOption[];
  disabled?: boolean;
  onPick: (article: ArticleOption | null) => void;
}) {
  const selected = articles.find((article) => article.id === articleId);
  const [query, setQuery] = useState(selected?.description ?? "");
  return (
    <Combobox
      label={label}
      placeholder="Artikel auswählen …"
      value={query}
      disabled={disabled}
      onInput={(value) => {
        setQuery(value);
        if (articleId) onPick(null);
      }}
      onBlur={() => setQuery(selected?.description ?? "")}
      search={() => searchOptions(articles, query, articleFields)}
      describe={describeArticle}
      onPick={(article) => {
        setQuery(article.description);
        onPick(article);
      }}
    />
  );
}
