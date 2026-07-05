import { describe, expect, it } from "vitest";
import { getJupiterQuote } from "./jupiter-quote-client.js";

describe("getJupiterQuote", () => {
  it("builds the request URL and parses the response", async () => {
    let capturedUrl: string | undefined;

    const response = {
      inputMint: "So11111111111111111111111111111111111111112",
      inAmount: "1000000000",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outAmount: "80722151",
      otherAmountThreshold: "80320841",
      swapMode: "ExactIn",
      slippageBps: 50,
      priceImpactPct: "0",
      routePlan: [
        {
          swapInfo: {
            ammKey: "GMCJvYGf5Ex2ARiMquaBDqU6iKM8uiEQkB8jCnoNfHpC",
            label: "GoonFi V2",
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "1000000000",
            outAmount: "80722151",
          },
          percent: 100,
        },
      ],
      contextSlot: 430958126,
      timeTaken: 0.001,
    };

    const quote = await getJupiterQuote(
      {
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1000000000",
      },
      {
        fetchFn: (async (url: string) => {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(response),
          };
        }),
      },
    );

    expect(capturedUrl).toContain("inputMint=So11111111111111111111111111111111111111112");
    expect(capturedUrl).toContain("amount=1000000000");
    expect(quote.outAmount).toBe("80722151");
    expect(quote.routePlan[0]!.swapInfo.ammKey).toBe("GMCJvYGf5Ex2ARiMquaBDqU6iKM8uiEQkB8jCnoNfHpC");
  });

  it("retries on a 429 and eventually succeeds", async () => {
    let attempts = 0;

    const quote = await getJupiterQuote(
      { inputMint: "A", outputMint: "B", amount: "1" },
      {
        retries: 2,
        fetchFn: (async () => {
          attempts += 1;
          if (attempts < 2) {
            return { ok: false, status: 429, text: async () => "rate limited" };
          }
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                inputMint: "A",
                inAmount: "1",
                outputMint: "B",
                outAmount: "1",
                otherAmountThreshold: "1",
                swapMode: "ExactIn",
                slippageBps: 50,
                priceImpactPct: "0",
                routePlan: [],
                contextSlot: 1,
                timeTaken: 0,
              }),
          };
        }),
      },
    );

    expect(attempts).toBe(2);
    expect(quote.outAmount).toBe("1");
  });
});
