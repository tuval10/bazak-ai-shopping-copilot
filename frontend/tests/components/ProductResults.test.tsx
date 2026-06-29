import { fireEvent, render, screen } from "@testing-library/react";
import { ProductResults } from "@/components/products/ProductResults";
import { BotMessage } from "@/components/chat/BotMessage";
import { mockGroup } from "../mocks/product-results";

describe("ProductResults", () => {
  it("renders one labelled block per intent for a multi-intent turn", () => {
    render(
      <ProductResults
        groups={[mockGroup({ intent: "phones under $500" }), mockGroup({ intent: "laptop bags" })]}
      />,
    );
    expect(screen.getAllByTestId("product-group")).toHaveLength(2);
    expect(screen.getByText(/phones under \$500/)).toBeInTheDocument();
    expect(screen.getByText(/laptop bags/)).toBeInTheDocument();
  });

  it("omits the per-intent label for a single group", () => {
    render(<ProductResults groups={[mockGroup({ intent: "headphones under $100" })]} />);
    expect(screen.getByTestId("product-group")).toBeInTheDocument();
    expect(screen.queryByText(/headphones under \$100/)).not.toBeInTheDocument();
  });

  it("shows the count and fires onShowMore", () => {
    const onShowMore = jest.fn();
    render(<ProductResults groups={[mockGroup()]} onShowMore={onShowMore} />);
    expect(screen.getByText(/Showing 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(onShowMore).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when there are no groups", () => {
    const { container } = render(<ProductResults groups={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a recommendation group as a spotlight card, not a grid", () => {
    render(
      <ProductResults
        groups={[mockGroup({ display: "recommendation", badge: "recommended", intent: "My pick for you" })]}
      />,
    );
    expect(screen.getByTestId("recommendation-card")).toBeInTheDocument();
    expect(screen.queryByTestId("product-group")).not.toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
  });

  it("renders a comparison group as a side-by-side table", () => {
    render(<ProductResults groups={[mockGroup({ display: "comparison", intent: "Side-by-side" })]} />);
    expect(screen.getByTestId("product-comparison")).toBeInTheDocument();
    expect(screen.queryByTestId("product-group")).not.toBeInTheDocument();
  });
});

describe("BotMessage", () => {
  it("renders the error tone with a working Retry", () => {
    const onRetry = jest.fn();
    render(<BotMessage tone="error" text="Couldn't reach the catalog." onRetry={onRetry} />);
    expect(screen.getByText("Couldn't reach the catalog.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a plain summary without a retry affordance", () => {
    render(<BotMessage text="Here are the cheapest options 👇" />);
    expect(screen.getByText("Here are the cheapest options 👇")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
