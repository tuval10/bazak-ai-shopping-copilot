import {
  type Product,
  type ProductListResponse,
  productListResponseSchema,
  productSchema,
} from "@bazak/shared";
import { type Category, categoryListSchema } from "./categories";

const BASE_URL = "https://dummyjson.com";

export interface PageParams {
  limit?: number;
  skip?: number;
}

/** Raised when the catalog API responds with a non-2xx status. */
export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

function buildUrl(path: string, query: Record<string, string | number | undefined>): string {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new CatalogError(`Catalog request failed: ${url}`, undefined);
  }
  if (!res.ok) {
    throw new CatalogError(`Catalog returned ${res.status} for ${url}`, res.status);
  }
  return res.json();
}

/** `/products/search?q=` — keyword/free-text search (US-1.1). */
export async function searchProducts(
  q: string,
  page: PageParams = {},
): Promise<ProductListResponse> {
  const data = await fetchJson(
    buildUrl("/products/search", { q, limit: page.limit, skip: page.skip }),
  );
  return productListResponseSchema.parse(data);
}

/** `/products/category/{slug}` — browse a whole category (US-1.6). */
export async function getCategoryProducts(
  slug: string,
  page: PageParams = {},
): Promise<ProductListResponse> {
  const data = await fetchJson(
    buildUrl(`/products/category/${encodeURIComponent(slug)}`, {
      limit: page.limit,
      skip: page.skip,
    }),
  );
  return productListResponseSchema.parse(data);
}

/** `/products` — the full catalog, paginated. */
export async function listProducts(page: PageParams = {}): Promise<ProductListResponse> {
  const data = await fetchJson(
    buildUrl("/products", { limit: page.limit, skip: page.skip }),
  );
  return productListResponseSchema.parse(data);
}

/** `/products/categories` — the real category list, backing term→slug mapping (US-1.6). */
export async function getCategories(): Promise<Category[]> {
  const data = await fetchJson(buildUrl("/products/categories", {}));
  return categoryListSchema.parse(data);
}

/** `/products/{id}` — a single product. */
export async function getProduct(id: number): Promise<Product> {
  const data = await fetchJson(buildUrl(`/products/${id}`, {}));
  return productSchema.parse(data);
}
