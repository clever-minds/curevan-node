module.exports = (req, res, next) => {
  res.success = (data = [], message = "Success") => {
    return res.status(200).json({
      success: true,
      message,
      data,
    });
  };

  res.error = (message = "Something went wrong", status = 500) => {
    return res.status(status).json({
      success: false,
      message,
    });
  };

  next();
};
