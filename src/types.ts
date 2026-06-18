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
	is_active_warning?: boolean;
	active_warning?: string[];
	_channel?: string;
};

export type MlResult = {
	active_warning: string[];
	sign_description: string;
	community_characteristics: string;
	action_recommendation: string;
};

export type MlPayload = {
	lik_codes: string[];
	beach_location: string;
	is_active_warning: boolean;
	active_warning: string[];
};

export type AlertEvent = {
	eventType: "DISASTER_ALERT";
	alertId: string;
	reportId: string;
	serverTimestamp: number;
	experimentId: string | null;
	client: {
		clientReportId: string | null;
		createdAtClient: number | null;
		userId: string | null;
		email: string | null;
	};
	decision: {
		community_characteristics: string;
		is_multisign: boolean;
		is_actionable: boolean;
		shouldDistribute: boolean;
	};
	input: MlPayload;
	ml: MlResult;
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
