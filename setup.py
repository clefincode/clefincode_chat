from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")


setup(
	name="clefincode_chat",
	version='1.3.6',
	description="ERPNext & Frappe Business Chat: A self-hosted communication solution.",
	author="ClefinCode L.L.C-FZ",
	author_email="info@clefincode.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
