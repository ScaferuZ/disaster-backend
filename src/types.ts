export type PredictionInput = {
	lik_codes: string[];
	level_of_interaction_with_disaster: number;
	age: number;
	usage_duration: number;
	min_frequency_of_usage: number;
	fishing_experience: number;
};

export type MlResult = {
	is_high_risk: boolean;
	description: string;
	detected_signs: Array<{ code: string; desc: string }>;
};

export type AckInput = {
	alertId: string;
	transport: "SSE" | "WS" | "PUSH";
	receivedAtClient: number;
	serverTimestamp: number;
	ackStage?: "DELIVERED" | "OPENED";
	// Optional fields you can add later:
	clientId?: string;
	// userId?: string;
};
