export const ALLOWED_BEACH_LOCATIONS = [
	"pantai_lampuuk",
	"pantai_lhoknga",
	"pantai_ulee_lheue",
	"pantai_depok",
	"pantai_samas",
] as const;

export type BeachLocation = (typeof ALLOWED_BEACH_LOCATIONS)[number];

export type PredictionInput = {
	lik_codes: string[];
	beach_location: BeachLocation;
	clientReportId?: string;
	createdAtClient?: number;
	_experimentId?: string;
	_channel?: string;
};

export type MlResult = {
	community_risk_behaviour: "Safe" | "Unsafe";
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
