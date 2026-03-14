import { GoogleGenAI, Type } from "@google/genai";
import { BurnData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeBurn(data: BurnData) {
  const monthlyExpenses = data.expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const netBurn = monthlyExpenses - data.monthlyRevenue;
  const runway = netBurn > 0 ? data.cashBalance / netBurn : Infinity;

  const prompt = `
    Analyze the following financial burn data for a small business/freelancer:
    - Cash Balance: $${data.cashBalance}
    - Monthly Revenue: $${data.monthlyRevenue}
    - Monthly Expenses: $${monthlyExpenses}
    - Net Monthly Burn: $${netBurn}
    - Current Runway: ${runway === Infinity ? 'Infinite' : runway.toFixed(1) + ' months'}

    Expenses Breakdown:
    ${data.expenses.map(e => `- ${e.category}: $${e.amount} (${e.description}) ${e.isSubscription ? '[Subscription]' : ''}`).join('\n')}

    Provide a professional fintech analysis. 
    1. Identify the top 2 areas for cost optimization.
    2. Suggest 3 specific actions to extend the runway.
    3. Give a brief overall sentiment on financial health.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of 3 specific actions to extend runway"
          },
          insights: {
            type: Type.STRING,
            description: "Overall sentiment and top optimization areas"
          }
        },
        required: ["suggestions", "insights"]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return {
    ...result,
    runwayMonths: runway,
    monthlyBurn: netBurn
  };
}
