import { mongoose } from "../mongo";

const auditLogSchema = new mongoose.Schema(
  {
    agencyId: { type: String, required: true },
    staffId: { type: String, required: true },
    userId: { type: String, required: true },
    action: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);