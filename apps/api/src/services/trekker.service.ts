
import bcrypt from 'bcrypt';
import { db } from "@funtush/database";
import { validateRegistrationInput } from "../utils/validator";


interface CreateTrekkerInput {
    id: string;
    email: string;
    password: string;
    name: string;
    phone: string;
    country: string;
    emergency_contact_name: string;
    emergency_contact_phone: string
}

export const createTrekker = async (data: CreateTrekkerInput) => {
    const {
        name, email, password, phone, country, emergency_contact_name, emergency_contact_phone
    } = data;

    // validation
    validateRegistrationInput({ email, password, phone });

    // check duplicate email
    const existing = await db.trekker.findUnique(
        { where: { email }, }
    );

    if (existing) {
        const error = new Error("Email already exists") as Error & { status?: number };
        error.status = 409;
        throw error;
    }

    const hashedPassword = await bcrypt.hash(
        password,
        10
    );

    // create agency
    const trekker = await db.trekker.create({
        data: {
            name,
            email,
            password,
            passwordHash: hashedPassword,
            phone,
            country,
            emergency_contact_name,
            emergency_contact_phone
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


interface trekkerPreferenceInput {
    trekkerId: string;
    preferred_destinations: string[];
    budget_range: string;
    group_size_preference: string;
}
export const trekkerPreferenceService = async (data: trekkerPreferenceInput, id:string) => {
    const {
        trekkerId, preferred_destinations, budget_range, group_size_preference
    } = data;

    // check duplicate email
    const existing = await db.trekkerPreference.findUnique(
        { where: {  id  }, }
    );

    if (!existing) {
        const error = new Error("Email doesnot exist") as Error & { status?: number };
        error.status = 400;
        throw error;
    }

    // create agency
    const trekkerPreference = await db.trekkerPreference.create({
        data: {
            trekkerId,
            preferred_destinations,
            budget_range,
            group_size_preference
        },
    });


    return {
        success: true,
        message: "Trekker preference added successfully",
        data: {
            trekkerPreference
        },
    };
};
