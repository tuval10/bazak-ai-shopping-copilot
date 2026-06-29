import { render, screen } from "@testing-library/react";
import { RecommendationCard } from "@/components/products/RecommendationCard";
import { mockGroup, mockProduct } from "../mocks/product-results";

describe("RecommendationCard", () => {
  it("shows the Recommended badge, the product, and the rationale", () => {
    render(
      <RecommendationCard
        group={mockGroup({
          display: "recommendation",
          badge: "recommended",
          products: [mockProduct({ id: 7, title: "Acme Buds Pro" })],
          rationale: "Best all-rounder for your commute.",
        })}
      />,
    );
    expect(screen.getByTestId("recommendation-card")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("Acme Buds Pro")).toBeInTheDocument();
    expect(screen.getByText("Best all-rounder for your commute.")).toBeInTheDocument();
  });

  it("shows the Best value for money badge", () => {
    render(
      <RecommendationCard
        group={mockGroup({ display: "recommendation", badge: "best-value", products: [mockProduct()] })}
      />,
    );
    expect(screen.getByText("Best value for money")).toBeInTheDocument();
  });

  it("renders nothing when the group has no product", () => {
    const { container } = render(
      <RecommendationCard group={mockGroup({ display: "recommendation", products: [] })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
