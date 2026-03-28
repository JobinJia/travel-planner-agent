export type DailyPlanItem = {
  timeOfDay: "morning" | "afternoon" | "evening";
  title: string;
  locationHint: string;
  activityType: "sightseeing" | "food" | "shopping" | "nature" | "transport" | "hotel" | "mixed";
};

export type DailyPlan = {
  day: number;
  theme: string;
  items: DailyPlanItem[];
};

export type ConfirmationAction = "keep" | "compress" | "extend" | "transit";

export type ConfirmationOption = {
  action: ConfirmationAction;
  label: string;
  description: string;
};

export type ThreadMessage = {
  role: "user" | "agent";
  content: string;
  createdAt: string;
};

export type TravelPreferenceProfile = {
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  budgetCny?: number;
  travelers?: number;
  interests: string[];
  pace?: "relaxed" | "balanced" | "packed";
  travelStyle?: "budget" | "balanced" | "premium";
  notes: string[];
};

export type CandidatePlan = {
  title: string;
  summary: string;
  pace: "relaxed" | "balanced" | "packed";
  travelStyle: "budget" | "balanced" | "premium";
  suitableFor: string;
  highlights: string[];
  dailyOutline: string[];
  dailyPlan: DailyPlan[];
};
