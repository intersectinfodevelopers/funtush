export const validateAcencyInput = (data: any) => {
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