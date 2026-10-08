function errorHandler(error, _req, res, _next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error("Request failed", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

module.exports = errorHandler;
