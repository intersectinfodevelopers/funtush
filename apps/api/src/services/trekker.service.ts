import { db } from "@funtush/database";
import { validateRegistrationInput } from "../utils/validator";
import bcrypt from "bcrypt";

interface CreateTrekkerInput {
    id: string;
    email: string;
    password: string;
    fullName: string;
    phone: string;
    country: string;
    emergency_contact_name: string;
    emergency_contact_phone: string
}
export const createTrekker = async (data: CreateTrekkerInput) => {
    const {
        fullName, email, password, phone, country, emergency_contact_name, emergency_contact_phone
    } = data;

    // validation
    validateRegistrationInput({ email, password, phone });

    // check duplicate USER (not trekker)
    const existingUser = await db.user.findUnique({
        where: { email },
    });

    if (existingUser) {
        const error = new Error("Email already exists") as Error & { status?: number };
        error.status = 409;
        throw error;
    }

    const hashedPassword = await bcrypt.hash(
        password,
        10
    );

    // create USER
    const user = await db.user.create({
        data: {
            email,
            passwordHash: hashedPassword,
            role: "STAFF",
            roleType: "TREKKER",
        },
    });

    // create TREKKER profile
    const trekker = await db.trekker.create({
        data: {
            userId: user.id,
            fullName: fullName,
            phone: phone,
            country: country,
            emergencyContactPhone: emergency_contact_phone,
            emergencyContactName: emergency_contact_name,
        },
    });


    return {
        success: true,
        message: "Trekker registered successfully",
        data: {
            trekker
        },
    };
};


interface TrekkerPreferenceInput {
    preferred_destinations?: string[];
    budget_range?: string;
    group_size_preference?: number;
}

/**
 * `trekkerId` is a caller-trusted argument, resolved by the controller from
 * the authenticated session's own trekker record — never accepted from the
 * request body. Previously this took the whole request body as a second
 * "id" parameter and looked up `TrekkerPreference` by *that* (a JSON object
 * where a string was expected, always a Prisma validation error), then
 * unconditionally created a new row with snake_case keys the schema doesn't
 * have (`preferredDestinations`/`budgetRange`/`groupSizePreference` are the
 * real column names) — the endpoint could never once succeed. Fixed to
 * `upsert` on `TrekkerPreference.trekkerId` (already `@unique`), which is
 * also what "PATCH a preferences row that may or may not exist yet" means.
 */
export const trekkerPreferenceService = async (trekkerId: string, data: TrekkerPreferenceInput) => {
    const { preferred_destinations, budget_range, group_size_preference } = data;

    const trekkerPreference = await db.trekkerPreference.upsert({
        where: { trekkerId },
        create: {
            trekkerId,
            preferredDestinations: preferred_destinations,
            budgetRange: budget_range,
            groupSizePreference: group_size_preference,
        },
        update: {
            ...(preferred_destinations !== undefined ? { preferredDestinations: preferred_destinations } : {}),
            ...(budget_range !== undefined ? { budgetRange: budget_range } : {}),
            ...(group_size_preference !== undefined ? { groupSizePreference: group_size_preference } : {}),
        },
    });

    return {
        success: true,
        message: "Trekker preference saved successfully",
        data: {
            trekkerPreference
        },
    };
};



