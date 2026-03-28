export type TravelStyle = "budget" | "balanced" | "premium";
export type TripType = "city" | "nature" | "business" | "mixed";

const baseBudgetPerDay: Record<string, Record<"budget" | "balanced" | "premium", number>> = {
  default: {
    budget: 350,
    balanced: 700,
    premium: 1500
  },
  japan: {
    budget: 650,
    balanced: 1100,
    premium: 2200
  },
  singapore: {
    budget: 700,
    balanced: 1300,
    premium: 2600
  },
  thailand: {
    budget: 250,
    balanced: 550,
    premium: 1200
  },
  france: {
    budget: 900,
    balanced: 1600,
    premium: 3200
  }
};

function normalizeDestination(destination: string): keyof typeof baseBudgetPerDay | "default" {
  const normalized = destination.toLowerCase();

  if (normalized.includes("japan") || normalized.includes("tokyo") || normalized.includes("osaka")) {
    return "japan";
  }

  if (normalized.includes("singapore")) {
    return "singapore";
  }

  if (normalized.includes("thailand") || normalized.includes("bangkok") || normalized.includes("phuket")) {
    return "thailand";
  }

  if (normalized.includes("france") || normalized.includes("paris")) {
    return "france";
  }

  return "default";
}

export function estimateBudget(input: {
  destination: string;
  days: number;
  travelers: number;
  travelStyle: TravelStyle;
}) {
  const key = normalizeDestination(input.destination);
  const perDay = baseBudgetPerDay[key][input.travelStyle];
  const hotelAndFood = perDay * input.days * input.travelers;
  const transport = Math.round(hotelAndFood * 0.22);
  const activities = Math.round(hotelAndFood * 0.18);
  const total = hotelAndFood + transport + activities;

  return {
    currency: "CNY",
    destination: input.destination,
    days: input.days,
    travelers: input.travelers,
    travelStyle: input.travelStyle,
    breakdown: {
      hotelAndFood,
      transport,
      activities
    },
    total
  };
}

export function getSeasonAdvice(destination: string, month?: number) {
  if (!month) {
    return "未提供出行月份，季节建议需要在确认月份后进一步校正。";
  }

  const shoulderSeason = [4, 5, 9, 10];
  const peakSeason = [6, 7, 8, 12];
  const destinationKey = normalizeDestination(destination);

  if (destinationKey === "thailand" && [6, 7, 8, 9, 10].includes(month)) {
    return "雨水较多，建议把海岛行程做成可调整版本，保留城市与美食备选方案。";
  }

  if (destinationKey === "japan" && [3, 4, 11].includes(month)) {
    return "热门季，酒店和热门餐厅建议提前锁定，核心景点尽量避开周末。";
  }

  if (shoulderSeason.includes(month)) {
    return "肩部季节通常在天气、价格和人流之间更平衡。";
  }

  if (peakSeason.includes(month)) {
    return "旺季体验通常更稳定，但价格更高、拥挤度更高。";
  }

  return "淡季可能更省预算，但要确认天气风险、营业时间和交通班次。";
}

export function buildPackingChecklist(input: {
  destination: string;
  weather: string;
  tripType: TripType;
  days: number;
}) {
  const clothingCount = Math.min(input.days, 7);
  const common = [
    `${clothingCount}件上装`,
    `${Math.max(2, Math.ceil(input.days / 2))}件下装`,
    "护照/身份证",
    "手机与充电器",
    "充电宝",
    "舒适步行鞋"
  ];

  const tripSpecific =
    input.tripType === "nature"
      ? ["轻量防雨外套", "户外背包", "防晒用品"]
      : input.tripType === "business"
        ? ["正式服装", "笔记本电脑", "证件资料夹"]
        : input.tripType === "city"
          ? ["随身小包", "交通卡收纳", "一套晚间外出服装"]
          : ["随身小包", "薄外套", "一套机动搭配"];

  const weatherSpecific =
    input.weather.includes("冷")
      ? ["保暖层", "外套", "手套"]
      : input.weather.includes("雨")
        ? ["雨伞", "防水鞋", "速干衣物"]
        : ["太阳镜", "帽子", "可重复使用水杯"];

  return [...common, ...tripSpecific, ...weatherSpecific];
}
