import { render, screen } from "@testing-library/react";
import { ProductComparison } from "@/components/products/ProductComparison";
import { mockGroup, mockProduct } from "../mocks/product-results";

const twoProducts = [
  mockProduct({ id: 1, title: "Acme Buds", price: 80, rating: 4.2 }),
  mockProduct({ id: 2, title: "Beats Flex", price: 120, rating: 4.7 }),
];

describe("ProductComparison", () => {
  it("renders both products, the spec rows, and the rationale", () => {
    render(
      <ProductComparison
        group={mockGroup({
          display: "comparison",
          products: twoProducts,
          rationale: "Acme is cheaper; Beats sounds better.",
        })}
      />,
    );
    expect(screen.getByTestId("product-comparison")).toBeInTheDocument();
    expect(screen.getByText("Acme Buds")).toBeInTheDocument();
    expect(screen.getByText("Beats Flex")).toBeInTheDocument();
    expect(screen.getByText("Acme is cheaper; Beats sounds better.")).toBeInTheDocument();
    // Spec rows are present.
    expect(screen.getAllByText("Price").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rating").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Availability").length).toBeGreaterThan(0);
  });

  it("marks the winner column with a Best pick tag", () => {
    render(
      <ProductComparison group={mockGroup({ display: "comparison", products: twoProducts, winnerId: 2 })} />,
    );
    expect(screen.getByText(/Best pick/)).toBeInTheDocument();
  });

  it("renders nothing when fewer than two products are present", () => {
    const { container } = render(
      <ProductComparison group={mockGroup({ display: "comparison", products: [mockProduct()] })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
