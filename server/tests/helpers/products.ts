import { type Product, productSchema } from "@bazak/shared";

let nextId = 1;

/** Build a valid Product for tests, overriding only the fields a case cares about. */
export function makeProduct(overrides: Partial<Product> = {}): Product {
  return productSchema.parse({
    id: overrides.id ?? nextId++,
    title: "Test Product",
    description: "A product for tests.",
    category: "misc",
    price: 100,
    thumbnail: "https://cdn.example.com/x.png",
    ...overrides,
  });
}

/** A raw DummyJSON list-response envelope around the given products. */
export function makeListResponse(products: Product[], total?: number) {
  return {
    products,
    total: total ?? products.length,
    skip: 0,
    limit: products.length,
  };
}
