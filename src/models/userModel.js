const database = require('../config/database');

const DEFAULT_NOTIFICATION_PREFERENCES = {
  documentExpiry: true,
  applicationUpdates: true,
  securityAccount: true
};

function normalizePreferences(preferences) {
  const notifications = preferences?.notifications || {};

  return {
    notifications: {
      documentExpiry: typeof notifications.documentExpiry === 'boolean'
        ? notifications.documentExpiry
        : DEFAULT_NOTIFICATION_PREFERENCES.documentExpiry,
      applicationUpdates: typeof notifications.applicationUpdates === 'boolean'
        ? notifications.applicationUpdates
        : DEFAULT_NOTIFICATION_PREFERENCES.applicationUpdates,
      securityAccount: true
    }
  };
}

function toPublicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: typeof user.phone === 'string' ? user.phone : null,
    preferences: normalizePreferences(user.preferences),
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
      phone: null,
      preferences: { notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES } },
      tokenVersion: 0,
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

function findUsersPendingDeletion() {
  return new Promise((resolve, reject) => {
    database.find({ deleting: true }, (error, users) => error ? reject(error) : resolve(users));
  });
}

function markUserDeletingById(id) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id },
      { $set: { deleting: true, updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function updateUserById(id, { name, email, phone, preferences }) {
  const updates = { updatedAt: new Date().toISOString() };

  if (name !== undefined) {
    updates.name = name;
  }

  if (email !== undefined) {
    updates.email = email;
  }

  if (phone !== undefined) {
    updates.phone = phone;
  }

  if (preferences !== undefined) {
    updates.preferences = normalizePreferences(preferences);
  }

  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, deleting: { $ne: true } },
      { $set: updates },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function changeUserPasswordById(id, currentPasswordHash, newPasswordHash) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, password: currentPasswordHash, deleting: { $ne: true } },
      {
        $set: { password: newPasswordHash, updatedAt: new Date().toISOString() },
        $inc: { tokenVersion: 1 }
      },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function incrementUserTokenVersionById(id) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, deleting: { $ne: true } },
      { $inc: { tokenVersion: 1 } },
      { returnUpdatedDocs: true },
      (error, count, user) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? user : null);
      }
    );
  });
}

function deleteUserById(id) {
  return new Promise((resolve, reject) => {
    database.remove({ _id: id }, {}, (error, count) => error ? reject(error) : resolve(count > 0));
  });
}

module.exports = {
  createUser,
  changeUserPasswordById,
  deleteUserById,
  findUserByEmail,
  findUserById,
  findUsersPendingDeletion,
  incrementUserTokenVersionById,
  markUserDeletingById,
  updateUserById,
  toPublicUser
};
