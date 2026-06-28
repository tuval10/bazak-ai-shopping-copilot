import { fireEvent, render, screen } from "@testing-library/react";
import { ProductCard } from "@/components/products/ProductCard";
import { mockProduct } from "../mocks/product-results";

describe("ProductCard", () => {
  it("shows title, description, image and the derived sale price + struck original", () => {
    render(
      <ProductCard
        product={mockProduct({
          title: "Beats Flex Wireless",
          description: "Wireless earphones.",
          brand: "Beats",
          price: 69,
          discountPercentage: 10,
          rating: 4.2,
          stock: 40,
        })}
      />,
    );
    expect(screen.getByText("Beats Flex Wireless")).toBeInTheDocument();
    expect(screen.getByText("Wireless earphones.")).toBeInTheDocument();
    expect(screen.getByAltText("Beats Flex Wireless")).toBeInTheDocument();
    // 69 * (1 - 0.10) = 62.1 → $62, with $69 struck through.
    expect(screen.getByText("$62")).toBeInTheDocument();
    expect(screen.getByText("$69")).toHaveClass("line-through");
    expect(screen.getByText("-10%")).toBeInTheDocument();
    expect(screen.getByText("★ 4.2")).toBeInTheDocument();
  });

  it("names the remaining count when stock is low", () => {
    render(<ProductCard product={mockProduct({ stock: 2 })} />);
    expect(screen.getByText("Low stock — 2 left")).toBeInTheDocument();
  });

  it("de-emphasises an out-of-stock product", () => {
    render(<ProductCard product={mockProduct({ stock: 0 })} />);
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByTestId("product-card")).toHaveClass("opacity-60");
  });

  it("omits the struck price when there is no discount", () => {
    render(<ProductCard product={mockProduct({ price: 100, discountPercentage: 0 })} />);
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.queryByText("-0%")).not.toBeInTheDocument();
  });

  it("falls back to the placeholder image when the thumbnail fails", () => {
    render(<ProductCard product={mockProduct({ title: "Broken", thumbnail: "https://x/404.png" })} />);
    const img = screen.getByAltText("Broken") as HTMLImageElement;
    fireEvent.error(img);
    expect(img.getAttribute("src")).toContain("data:image/svg+xml");
  });
});
