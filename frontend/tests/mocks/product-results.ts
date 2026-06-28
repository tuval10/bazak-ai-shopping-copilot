import { type Product, type ProductResultsPart, productSchema } from "@bazak/shared";

/** Build a valid Product for tests, overriding only the fields a case cares about. */
export function mockProduct(overrides: Partial<Product> = {}): Product {
  return productSchema.parse({
    id: 1,
    title: "Test Product",
    description: "A product for tests.",
    category: "smartphones",
    price: 100,
    thumbnail: "https://cdn.dummyjson.com/x.png",
    ...overrides,
  });
}

/** A product-results group (the D6 part / D12 rehydrated shape). */
export function mockGroup(overrides: Partial<ProductResultsPart> = {}): ProductResultsPart {
  return {
    intent: "headphones under $100",
    products: [mockProduct({ id: 1, title: "Acme Buds" }), mockProduct({ id: 2, title: "Beats Flex" })],
    ...overrides,
  };
}
