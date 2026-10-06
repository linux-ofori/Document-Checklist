const database = require('../config/database');

function toPublicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
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

function updateUserById(id, { name, email }) {
  const updates = { updatedAt: new Date().toISOString() };

  if (name !== undefined) {
    updates.name = name;
  }

  if (email !== undefined) {
    updates.email = email;
  }

  return new Promise((resolve, reject) => {
    database.update({ _id: id }, { $set: updates }, { returnUpdatedDocs: true }, (error, count, user) => {
      if (error) {
        return reject(error);
      }

      return resolve(count > 0 ? user : null);
    });
  });
}

function deleteUserById(id) {
  return new Promise((resolve, reject) => {
    database.remove({ _id: id }, {}, (error, count) => error ? reject(error) : resolve(count > 0));
  });
}

module.exports = {
  createUser,
  deleteUserById,
  findUserByEmail,
  findUserById,
  updateUserById,
  toPublicUser
};
