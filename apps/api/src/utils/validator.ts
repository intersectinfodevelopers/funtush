interface registrationInput {
  email: string;
  password: string;
  phone: string;
}

export const validateRegistrationInput = (data: registrationInput) => {
  const { email, password, phone } = data;

  if (!email.includes("@")) {
    throw new Error("Invalid email format");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (!/^(98|97)\d{8}$/.test(phone)) {
    throw new Error("Invalid phone format");
  }
};