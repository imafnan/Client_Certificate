import mongoose from "mongoose";

/** Atomic increment for certificate ref_no / sequenceId. */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter =
  mongoose.models.Counter ?? mongoose.model("Counter", counterSchema);
