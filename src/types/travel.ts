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

export type BudgetEstimate = {
  currency: "CNY";
  destination: string;
  days: number;
  travelers: number;
  travelStyle: "budget" | "balanced" | "premium";
  breakdown: {
    hotelAndFood: number;
    transport: number;
    activities: number;
  };
  total: number;
};

export type RouteModeSummary = {
  walking?: number;
  transit?: number;
  driving?: number;
};

export type DailyRouteMetric = {
  dayLabel: string;
  preferredMinutes: number | null;
  congestionLevel: "低" | "中" | "高" | "未知";
  minutesByMode: RouteModeSummary;
};

export type OptionRouteMetrics = {
  title: string;
  preferredMode: "walking" | "transit" | "driving";
  preferredModeLabel: string;
  preferredMinutes: number | null;
  congestionLevel: "低" | "中" | "高" | "未知";
  averagePreferredMinutesPerDay: number | null;
  peakPreferredMinutesPerDay: number | null;
  evaluatedDays: number;
  sampleMinutesByMode: RouteModeSummary;
  dailyMetrics: DailyRouteMetric[];
};

export type OptionComparison = {
  title: string;
  summary: string;
  pace: "relaxed" | "balanced" | "packed";
  travelStyle: "budget" | "balanced" | "premium";
  suitableFor: string;
  budget: BudgetEstimate;
  budgetFit: string;
  routeMetrics?: OptionRouteMetrics;
};
