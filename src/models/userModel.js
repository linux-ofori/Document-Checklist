const database = require('../config/database');

function toPublicUser(user) {
  if (!user) {
    return null;
  }

  const { _id, password, ...publicUser } = user;
  return { id: _id, ...publicUser };
}

function createUser({ name, email, password }) {
  const timestamp = new Date().toISOString();
  return new Promise((resolve, reject) => {
    database.insert({
      name,
      email,
      password,
      createdAt: timestamp,
      updatedAt: timestamp
    }, (error, user) => error ? reject(error) : resolve(user));
  });
}

function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    database.findOne({ email }, (error, user) => error ? reject(error) : resolve(user));
  });
}

function findUserById(id) {
  return new Promise((resolve, reject) => {
    database.findOne({ _id: id }, (error, user) => error ? reject(error) : resolve(user));
  });
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  toPublicUser
};
