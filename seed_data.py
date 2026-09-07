db.executemany("INSERT INTO users(username, password) VALUES (?, ?)", [("alex", "bluebird"), ("morgan", "sunrise")])
db.executemany("INSERT INTO products(name, category, description) VALUES (?, ?, ?)", [("Horizon Checking", "checking", "Everyday local banking"), ("Community Saver", "savings", "A calm place for rainy days"), ("Student Starter", "checking", "Fictional practice account")])
db.executemany("INSERT INTO accounts(account_number, owner, balance) VALUES (?, ?, ?)", [("10001", "Alex Rivera", 1200), ("10002", "Morgan Lee", 875), ("10003", "Taylor Chen", 2400)])
